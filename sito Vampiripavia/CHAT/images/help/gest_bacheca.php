<?
	include ("./header_bacheca.php");
	
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
	$sql .= "SELECT argomenti.titolo,argomenti.id,capitoli.titolo_capitolo,capitoli.id AS id_capitolo,pos ";
	$sql .= "FROM bacheca_argomenti argomenti RIGHT JOIN bacheca_capitoli capitoli ";
	$sql .= "ON capitoli.id = argomenti.id_capitolo ";
	$sql .= "ORDER BY capitoli.id,argomenti.pos";
	
	$query = mysql_query($sql);
?>

<script language="javascript">
	function del_arg(id){	
		var res = window.confirm("Vuoi eliminare questo argomento?");
		
		if (res){			
			window.location = "gest_bacheca_del_arg.php?id=" + id;
		}
	}
	
	function del_cap(id){	
		
		var res = window.confirm("Vuoi eliminare l'intero capitolo?");
		
		if (res){			
			window.location = "gest_bacheca_del_cap.php?id=" + id;
		}
	}
	
	function sort(id){
		window.open("gest_bacheca_sort.php?id=" + id,"sort","left=200,top=80,width=400,height=150,toolbar=no,statusbar=no,scrollbars=no");
	}

	function check_capitoli(){
		if (document.add_capitolo.capitolo.value == ""){
			alert("Scegliere il nome del Capitolo");
			return false;
		}
	}
		
</script>

<table border="0" cellpadding="0" cellspacing="0" width="100%">
	<?
	$id_capitolo = "";
	while ($result = mysql_fetch_array($query)){	
		
		$bgcolor = "#2C0707";		
		if ($bgcolor == "#2C0707"){
			$bgcolor = "#3C0707";
		}else{
			$bgcolor = "#2C0707";
		}
			
	?>
	
	<?
		if (($result['id_capitolo'] != $id_capitolo) || ($result['id_capitolo'] == "")){
	?>	
	
    <tr>    				
        <td class="medium" align="center">
        	<br><br>
            <a href="javascript:del_cap(<?=$result['id_capitolo']?>)"><img src="../images/trash.gif" border="0"></a>Capitolo: <?=$result['titolo_capitolo']?>
        </td>
    </tr>
    <? } ?>
    
    <? if ($result['id'] != ""){ ?>
    <form name="move" method="post" action="gest_bacheca_movearg.php">
    <tr>
    	<td width="100%">
    		<table border="0" cellpadding="0" cellspacing="1" width="100%">
    			<tr>
			    	<td width="11" bgcolor="<?=$bgcolor?>">
			    		<a href="javascript:del_arg(<?=$result['id']?>)"><img src="../images/trash.gif" border="0"></a>
			    	</td>
			        <td class="medium" width="100%" bgcolor="<?=$bgcolor?>">
			            <a href="gest_bacheca_mod.php?id=<?=$result['id']?>" class="plain_e"><?=$result['titolo']?></a><br>            
			        </td>
			        <td width="11" bgcolor="<?=$bgcolor?>" valign="bottom">
			    		<a href="javascript:sort(<?=$result['id']?>)"><img src="../images/sort.gif" border="0"></a>
			    	</td>			    	
			        <td width="11" bgcolor="<?=$bgcolor?>">			        	
			    		<input type="text" size="2" name="lvl" class="textfield_scuro" value="<?=$result['pos']?>">			    
			    	</td>	
			    	<td width="11" bgcolor="<?=$bgcolor?>">	
			    		<input type="submit" value="Move" class="button">			    					    		
			    	</td>	    	
			    </tr>
			</table>
		</td>
	</tr>			  
			   
	<input type="hidden" name="id" value="<?=$result['id']?>">
	</form> 
	<? }			
		
		$id_capitolo = $result['id_capitolo'];
	} 
	?>
		
		
	<tr>
		<td colspan="4">
			<br><br>
			<table border="0" cellpadding="1" cellspacing="0">
				<tr>
					<form action="gest_bacheca_add_capitolo.php" method="post" name="add_capitolo" onSubmit="return check_capitoli()">
					<td class="medium" align="right">Capitolo: </td>
					<td><input type="text" class="textfield_scuro" size="30" name="capitolo"></td>
					<td><input type="submit" class="button" value="Nuovo"></td>
					</form>
				</tr>
			
				<tr>
					<form action="gest_bacheca_add_arg.php" method="post" name="add_arg">
					<td class="medium">Argomento: </td>
					<td><input type="text" class="textfield_scuro" size="30" name="argomento"></td>
					<td><input type="submit" class="button" value="Nuovo"></td>
				</tr>
				<tr>
					<td>&nbsp;</td>
					<td><?=$combo_capitoli?></td>	
					</form>				
				</tr>					
			</table>
		</td>
	</tr>
	
	<tr>
		<td class="small" align="center">
			<br><br><a href="javascript:self.close()" class="plain_e">Chiudi</a>
		</td>
	</tr>
</table>

<?
	CloseConnection();
	
	include ("./footer_bacheca.php");
?>
