<?
	include ("./header_help.php");
	
	OpenConnection();		
	
	$sql = "";
	$sql .= "SELECT argomenti.titolo,argomenti.id_capitolo,argomenti.id, ";
	$sql .= "capitoli.titolo_capitolo ";
	$sql .= "FROM help_argomenti argomenti INNER JOIN help_capitoli capitoli ";
	$sql .= "ON capitoli.id = argomenti.id_capitolo ";
	$sql .= "ORDER BY capitoli.id,pos,argomenti.id";
	
	$query = mysql_query($sql);
?>

<table border="0" cellpadding="0" cellspacing="1" width="100%">
	<tr>
		<td class="medium" align="center" bgcolor="#444444"><b>LA CHAT DI VAMPIRIPAVIA</b></td>
	</tr>

	<?
	$id_capitolo = "";
	while ($result = mysql_fetch_array($query)){				
	?>
	
	<?
		if ($result['id_capitolo'] != $id_capitolo){
	?>
    <tr>
        <td class="medium_oro" align="center">
        	<br><br>
            <b> - <?=$result['titolo_capitolo']?> - </b>
        </td>
    </tr>
    <? } ?>
    
    <tr>
        <td class="medium" align="center">
            <a href="help_a.php?id=<?=$result['id']?>" class="plain_e" onMouseOver="this.className='medium_over'" onMouseOut="this.className='medium'"><?=$result['titolo']?></a><br>            
        </td>
    </tr>
	
	<? 
		$id_capitolo = $result['id_capitolo'];
	} 
	?>

	<tr>
		<td class="small" align="center">
			<br><br><a href="javascript:self.close()" class="plain_e">Chiudi</a>
		</td>
	</tr>
</table>

<?
	include ("./footer_help.php");
?>
