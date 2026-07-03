<?
	include ("./header_bacheca.php");
	
	OpenConnection();
	
	$sql = "";
	$sql .= "SELECT titolo,testo ";	
	$sql .= "FROM bacheca_argomenti ";	
	$sql .= "WHERE id = ".$_GET['id'];
	
	$query = mysql_query($sql);
?>

<table border="0" cellpadding="0" cellspacing="0" width="98%" align="center">    
	<tr>
		<td class="menu" colspan="2" align="center" height="20" background="../images/sfondo_marmo.jpg"><?=mysql_result($query,0,'titolo')?></td>
	</tr>
	
	<tr>
		<td class="medium">
			<br>
			<?=mysql_result($query,0,'testo')?>
		</td>
	</tr>
	
	<tr>
    	<td class="small" colspan="2" align="center">
    		<br><br>
    		<a href="bacheca.php" class="plain_e">Indice</a>
    	</td>
    </tr>							            	
</table>

<?
	CloseConnection();
	
	include ("./footer_bacheca.php");
?>