<?
	include ("./header_bacheca.php");
	
	$id = $_GET['id'];
	
	OpenConnection();
	
	//COMBO CAPITOLI
	$sql_combo_capitoli = "SELECT * FROM bacheca_capitoli";
	
	$query = mysql_query($sql_combo_capitoli);
	
	$combo_capitoli = "<select name=\"id_capitolo\" class=\"textfield_scuro\">";
	while ($result = mysql_fetch_array($query)){
		$combo_capitoli .= "<option value=\"".$result['id']."\">".$result['titolo_capitolo']."</option>";	
	}
	$combo_capitoli .= "</select>";
	//
	
	
	$sql = "";
	$sql .= "SELECT argomenti.titolo,argomenti.id_capitolo,argomenti.id,capitoli.titolo_capitolo ";
	$sql .= "FROM bacheca_argomenti argomenti INNER JOIN bacheca_capitoli capitoli ";
	$sql .= "ON capitoli.id = argomenti.id_capitolo ";
	$sql .= "WHERE argomenti.id = ".$id;
	
	$query = mysql_query($sql);
		
?>	
	
<table border="0" cellpadding="0" cellspacing="0" width="100%">
	<tr>
		<td class="medium" align="center">
			<form method="post" name="sort" action="gest_bacheca_dosort.php">
			Argomento: <?=mysql_result($query,0,'titolo')?><br><br>
		</td>
	</tr>
	<tr>
		<td align="center" class="medium">
			Capitolo: <?=$combo_capitoli?><br><br>
			<input type="hidden" name="id_argomento" value="<?=$id?>">			
		</td>
	</tr>
	<tr>
		<td align="center">
			<input type="submit" value="Modifica" class="button">
			</form>
		</td>
	</tr>
</table>
	
<?
	CloseConnection();
	
	include ("./footer_bacheca.php");
?>
